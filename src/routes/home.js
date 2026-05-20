import { Router } from 'express';

export const homeRouter = Router();

homeRouter.get('/', (req, res) => {
  res.render('pages/home', { title: '匹克球比賽平台' });
});
