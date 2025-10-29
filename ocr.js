// ocr.js
window.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const imageUrl = params.get('image');

  const preview = document.getElementById('preview');
  const output = document.getElementById('output');
  const progress = document.getElementById('progress');

  if (!imageUrl) {
    progress.textContent = '❌ No image URL detected. Make sure you are passing ?image=...';
    return;
  }

  preview.src = imageUrl;
  progress.textContent = 'Loading and scanning image...';

  const { createWorker } = Tesseract;
 function updateProgress(m) {
  if (m.status === 'recognizing text') {
    progress.textContent = `Scanning: ${(m.progress * 100).toFixed(1)}%`;
  }
}

// Create the worker and assign the logger
const worker = await Tesseract.createWorker();
worker.logger = updateProgress;

  await worker.loadLanguage('eng');
  await worker.initialize('eng');

  const { data: { text } } = await worker.recognize(imageUrl);

  const formatted = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length)
    .join('<br>');

  output.innerHTML = formatted;
  progress.textContent = '✅ OCR complete — copy this text into your importer field.';

  await worker.terminate();
});
