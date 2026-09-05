/**
 * Wonder Payment（參考 checkinSystem/utils/wonderPayment.js）
 * .env: PAYMENT_DEV=true → gateway-stg；SITE_URL → callback／redirect
 */
import axios from 'axios';
import { WonderSignature } from './wonderSignature.js';

const WONDER_ECHO_URI = '/svc/payment/api/v1/openapi/echo';
const WONDER_ORDER_API_PATH = '/svc/payment/api/v1/openapi/orders';

function getPaymentBaseUrl() {
  const dev = String(process.env.PAYMENT_DEV || '').trim().toLowerCase();
  const isDev = dev === 'true' || dev === '1';
  return isDev ? 'https://gateway-stg.wonder.today' : 'https://gateway.wonder.today';
}

function formatTimeToYYYYMMDDHHMMSS(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

export function getWonderConfig() {
  const appId = String(process.env.WONDER_APP_ID || '').trim();
  const customerUuid = String(process.env.WONDER_CUSTOMER_UUID || '').trim();
  const apiKey = String(process.env.WONDER_API_KEY || '').trim();
  const privateKey = String(process.env.WONDER_PRIVATE_KEY || '')
    .replace(/\\n/g, '\n')
    .trim();
  return { appId, customerUuid, apiKey, privateKey };
}

function getWonderAuthHeaders(privateKey, appId, method, uri, bodyString, credentialTime) {
  if (!privateKey || !appId) {
    throw new Error('WONDER_PRIVATE_KEY and WONDER_APP_ID are required');
  }
  const wonderSignature = new WonderSignature();
  const nonce = WonderSignature.generateRandomString(16);
  const now = credentialTime || formatTimeToYYYYMMDDHHMMSS();
  const credential = `${appId}/${now}/Wonder-RSA-SHA256`;
  const signature = wonderSignature.signature(privateKey, credential, nonce, method, uri, bodyString || null);
  return { Credential: credential, Nonce: nonce, Signature: signature };
}

async function wonderAuthenticate() {
  const baseUrl = getPaymentBaseUrl();
  const { appId, privateKey } = getWonderConfig();
  if (!appId || !privateKey || !privateKey.includes('BEGIN')) {
    throw new Error('WONDER_APP_ID and WONDER_PRIVATE_KEY are required');
  }
  const now = formatTimeToYYYYMMDDHHMMSS();
  const authBodyString = JSON.stringify({ message: `Hello, Current timestamp is ${now}` });
  const method = 'POST';
  const uri = WONDER_ECHO_URI;
  const authHeaders = getWonderAuthHeaders(privateKey, appId, method, uri, authBodyString, now);
  const response = await axios.post(`${baseUrl}${WONDER_ECHO_URI}`, authBodyString, {
    headers: {
      'Content-Type': 'application/json',
      Credential: authHeaders.Credential,
      Nonce: authHeaders.Nonce,
      Signature: authHeaders.Signature,
    },
    timeout: 15000,
    validateStatus: () => true,
  });
  if (response.status !== 200) {
    throw new Error(`Wonder auth failed: ${response.status}`);
  }
}

/**
 * @returns {Promise<{ paymentUrl: string, orderId: string }>}
 */
export async function createWonderOrder(params) {
  const baseUrl = getPaymentBaseUrl();
  const { appId, customerUuid, apiKey, privateKey } = getWonderConfig();
  if (!appId) throw new Error('WONDER_APP_ID is required');

  await wonderAuthenticate();

  const amountStr =
    typeof params.amount === 'number' ? params.amount.toFixed(2) : String(params.amount || '0.00');

  const body = {
    app_id: appId,
    order: {
      reference_number: String(params.referenceNumber || ''),
      charge_fee: amountStr,
      currency: (params.currency || 'HKD').toUpperCase(),
      note: String(params.note || ''),
      callback_url: params.callbackUrl,
      redirect_url: params.redirectUrl,
    },
  };
  if (customerUuid) body.customer_uuid = customerUuid;

  const plainText = JSON.stringify(body);
  const query = 'with_payment_link=true';
  const uriWithQuery = `${WONDER_ORDER_API_PATH}?${query}`;
  const url = `${baseUrl}${uriWithQuery}`;
  const method = 'POST';
  const orderAuthHeaders = getWonderAuthHeaders(privateKey, appId, method, uriWithQuery, plainText);
  const headers = {
    'Content-Type': 'application/json',
    Credential: orderAuthHeaders.Credential,
    Nonce: orderAuthHeaders.Nonce,
    Signature: orderAuthHeaders.Signature,
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers['X-API-Key'] = apiKey;
  }

  const response = await axios.post(url, plainText, {
    headers,
    timeout: 15000,
    validateStatus: () => true,
  });

  if (response.status !== 200 && response.status !== 201) {
    const msg = response.data?.message || response.data?.error || JSON.stringify(response.data);
    throw new Error(`Wonder create order failed: ${response.status} - ${msg}`);
  }

  const data = response.data || {};
  const paymentUrl =
    data.payment_url ||
    data.url ||
    data.data?.payment_url ||
    data.data?.url ||
    data.data?.payment_link;
  const orderId =
    data.order_id || data.id || data.data?.order_id || data.data?.id || data.reference_number;

  if (!paymentUrl) {
    throw new Error('Wonder API did not return payment_url');
  }

  return { paymentUrl, orderId: orderId || params.referenceNumber };
}
