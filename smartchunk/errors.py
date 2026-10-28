"""Engine-level errors. The API layer maps each one to an error code from spec A4."""


class DocumentError(Exception):
    """Base class for problems with an input document."""


class EmptyDocumentError(DocumentError):
    """No extractable text."""


class ScannedPdfError(DocumentError):
    """Image-only PDF (OCR is not supported)."""


class EncryptedPdfError(DocumentError):
    """Password-protected PDF."""


class UnsupportedFileError(DocumentError):
    """Extension is not pdf, md, markdown or txt."""
