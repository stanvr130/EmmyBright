import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../src/config/cloudinary.js';

// 🔄 CHANGED: storage now points to Cloudinary instead of local disk.
// No more local uploads/ folder — files are streamed directly to
// Cloudinary's servers, so nothing is lost when the server restarts
// or redeploys (which local disk storage would not survive on hosts
// like Render/Railway).
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'lafamilia-products', // keeps your uploads organized in one Cloudinary folder
    allowed_formats: ['jpeg', 'jpg', 'png', 'webp', 'gif'],
    transformation: [{ width: 1200, height: 1200, crop: 'limit' }] // caps oversized uploads, saves storage/bandwidth
  }
});

// File filter to allow only image mime types (unchanged logic, still runs
// before the file is streamed to Cloudinary)
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp|gif/;
  const mimeType = allowedTypes.test(file.mimetype);

  if (mimeType) {
    return cb(null, true);
  }
  cb(new Error('Only image files (jpeg, jpg, png, webp, gif) are allowed!'));
};

// Initialize Multer with 5MB file limit — unchanged
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB Limit
});

export default upload;