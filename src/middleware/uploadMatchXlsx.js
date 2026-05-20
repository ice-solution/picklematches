import multer from 'multer';

const storage = multer.memoryStorage();

export const uploadMatchXlsx = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    cb(null, ok);
  },
});
