/**
 * 場地 Live／裁判 Panel 用：Socket 重連必再 join、離線／切頁自動補拉 state。
 * 用法：CourtLiveLink.connect({ join, onUpdate, fetchState, pollMs })
 */
(function (global) {
  function connect(opts) {
    opts = opts || {};
    var joinPayload = opts.join || {};
    var onUpdate = typeof opts.onUpdate === 'function' ? opts.onUpdate : function () {};
    var fetchState = typeof opts.fetchState === 'function' ? opts.fetchState : null;
    var pollMs = Number(opts.pollMs) > 0 ? Number(opts.pollMs) : 8000;
    var eventName = opts.eventName || 'court:update';

    if (typeof io !== 'function') {
      console.error('CourtLiveLink: socket.io 未載入');
      return null;
    }

    var socket = io({
      transports: ['websocket', 'polling'],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 400,
      reconnectionDelayMax: 4000,
      randomizationFactor: 0.4,
      timeout: 15000,
    });

    var pulling = false;
    var lastPullAt = 0;

    function joinRooms() {
      try {
        socket.emit('join', joinPayload);
      } catch (e) {
        console.warn('CourtLiveLink join failed', e);
      }
    }

    function pullState(force) {
      if (!fetchState) return;
      var now = Date.now();
      if (!force && pulling) return;
      if (!force && now - lastPullAt < 1200) return;
      pulling = true;
      lastPullAt = now;
      Promise.resolve()
        .then(function () {
          return fetchState();
        })
        .then(function (match) {
          onUpdate(match);
        })
        .catch(function () {})
        .then(function () {
          pulling = false;
        });
    }

    socket.on('connect', function () {
      joinRooms();
      pullState(true);
    });

    socket.io.on('reconnect', function () {
      joinRooms();
      pullState(true);
    });

    socket.on(eventName, function (payload) {
      onUpdate(payload && Object.prototype.hasOwnProperty.call(payload, 'match') ? payload.match : payload);
    });

    socket.on('disconnect', function () {
      // 斷線期間靠輪詢；重連後 connect 會再 join + pull
    });

    var pollTimer = setInterval(function () {
      if (document.hidden) return;
      pullState(false);
    }, pollMs);

    function onVisible() {
      if (document.hidden) return;
      if (!socket.connected) {
        try {
          socket.connect();
        } catch (e) {}
      }
      joinRooms();
      pullState(true);
    }

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener('pageshow', onVisible);

    // 首次：未連上前也先拉一次
    pullState(true);

    return {
      socket: socket,
      refresh: function () {
        joinRooms();
        pullState(true);
      },
      destroy: function () {
        clearInterval(pollTimer);
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('focus', onVisible);
        window.removeEventListener('online', onVisible);
        window.removeEventListener('pageshow', onVisible);
        try {
          socket.close();
        } catch (e) {}
      },
    };
  }

  global.CourtLiveLink = { connect: connect };
})(typeof window !== 'undefined' ? window : globalThis);
