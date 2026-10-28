/** Saves a Blob as a file by clicking a temporary link. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Give the browser a moment to start the download before releasing the object URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
