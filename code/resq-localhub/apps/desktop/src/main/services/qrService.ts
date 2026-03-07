// provides QR code generation for pairing devices
// stub implementation returns placeholder data URL

export async function generateQr(data: string): Promise<string> {
  // TODO: integrate with library like `qrcode`
  console.log(`Generating QR for: ${data}`);
  return `data:image/png;base64,PLACEHOLDER`; // replace with real image
}
