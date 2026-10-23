export type ImagePurpose = "post" | "chat" | "avatar";

export type ProcessedImage = {
  blob: Blob;
  width: number;
  height: number;
};

const IMAGE_INPUT_LIMITS: Record<ImagePurpose, number> = {
  post: 5 * 1024 * 1024,
  chat: 5 * 1024 * 1024,
  avatar: 1 * 1024 * 1024,
};

const IMAGE_OUTPUT_LIMITS: Record<ImagePurpose, number> = {
  post: 1.5 * 1024 * 1024,
  chat: 1.5 * 1024 * 1024,
  avatar: 1 * 1024 * 1024,
};

const IMAGE_DIMENSION_LIMITS: Record<ImagePurpose, number> = {
  post: 1600,
  chat: 1600,
  avatar: 512,
};

const ACCEPTED_INPUT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This image could not be opened. Try a JPEG, PNG, or WebP image."));
    };
    image.src = url;
  });
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Your browser could not compress this image. Try another image."));
        return;
      }
      if (blob.type !== "image/webp") {
        reject(new Error("This browser cannot create WebP images. Update your browser to attach images."));
        return;
      }
      resolve(blob);
    }, "image/webp", quality);
  });
}

export async function processImage(file: File, purpose: ImagePurpose): Promise<ProcessedImage> {
  if (!ACCEPTED_INPUT_TYPES.has(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size <= 0 || file.size > IMAGE_INPUT_LIMITS[purpose]) {
    const limitMb = IMAGE_INPUT_LIMITS[purpose] / (1024 * 1024);
    throw new Error(`Image must be smaller than ${limitMb} MB before compression.`);
  }

  const image = await loadImage(file);
  const maxDimension = IMAGE_DIMENSION_LIMITS[purpose];
  let scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image compression is unavailable in this browser.");

  for (let resizeAttempt = 0; resizeAttempt < 12; resizeAttempt += 1) {
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (let quality = 0.84; quality >= 0.52; quality -= 0.08) {
      const blob = await canvasToWebp(canvas, quality);
      if (blob.size <= IMAGE_OUTPUT_LIMITS[purpose]) return { blob, width, height };
    }
    scale *= 0.82;
  }

  throw new Error("Image could not be compressed below the size limit. Try a smaller image.");
}
