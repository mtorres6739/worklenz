import path from "path";
import { NextFunction, Request, Response } from "express";

import { ClientPortalRequest } from "../../interfaces/client-portal-request";
import { ServerResponse } from "../../models/server-response";
import { getConfiguredUploadBytes } from "../../shared/self-hosted-capabilities";

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const configuredLimit = Number(
  process.env.PORTAL_REQUEST_ATTACHMENT_MAX_BYTES || DEFAULT_MAX_BYTES,
);

export const MAX_PORTAL_REQUEST_ATTACHMENT_BYTES = Math.min(
  Number.isFinite(configuredLimit) && configuredLimit > 0
    ? Math.floor(configuredLimit)
    : DEFAULT_MAX_BYTES,
  getConfiguredUploadBytes(),
);

type FileRule = {
  mimeTypes: Set<string>;
  matches: (buffer: Buffer) => boolean;
};

const zipMagic = (buffer: Buffer) =>
  buffer.subarray(0, 4).equals(Buffer.from("504b0304", "hex")) ||
  buffer.subarray(0, 4).equals(Buffer.from("504b0506", "hex")) ||
  buffer.subarray(0, 4).equals(Buffer.from("504b0708", "hex"));
const openXmlDocument = (folder: "word" | "xl" | "ppt") => (buffer: Buffer) =>
  zipMagic(buffer) &&
  buffer.includes(Buffer.from("[Content_Types].xml")) &&
  buffer.includes(Buffer.from(`${folder}/`));
const compoundDocumentMagic = (buffer: Buffer) =>
  buffer.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"));
const textContent = (buffer: Buffer) =>
  buffer.length > 0 && !buffer.subarray(0, 8192).includes(0);

const RULES: Record<string, FileRule> = {
  pdf: {
    mimeTypes: new Set(["application/pdf"]),
    matches: (buffer) => buffer.subarray(0, 5).toString("ascii") === "%PDF-",
  },
  png: {
    mimeTypes: new Set(["image/png"]),
    matches: (buffer) =>
      buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  },
  jpg: {
    mimeTypes: new Set(["image/jpeg"]),
    matches: (buffer) =>
      buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  },
  jpeg: {
    mimeTypes: new Set(["image/jpeg"]),
    matches: (buffer) =>
      buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  },
  gif: {
    mimeTypes: new Set(["image/gif"]),
    matches: (buffer) =>
      /^(GIF87a|GIF89a)$/.test(buffer.subarray(0, 6).toString()),
  },
  webp: {
    mimeTypes: new Set(["image/webp"]),
    matches: (buffer) =>
      buffer.subarray(0, 4).toString() === "RIFF" &&
      buffer.subarray(8, 12).toString() === "WEBP",
  },
  docx: {
    mimeTypes: new Set([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
    matches: openXmlDocument("word"),
  },
  xlsx: {
    mimeTypes: new Set([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]),
    matches: openXmlDocument("xl"),
  },
  pptx: {
    mimeTypes: new Set([
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ]),
    matches: openXmlDocument("ppt"),
  },
  doc: {
    mimeTypes: new Set(["application/msword", "application/x-ole-storage"]),
    matches: compoundDocumentMagic,
  },
  xls: {
    mimeTypes: new Set([
      "application/vnd.ms-excel",
      "application/x-ole-storage",
    ]),
    matches: compoundDocumentMagic,
  },
  ppt: {
    mimeTypes: new Set([
      "application/vnd.ms-powerpoint",
      "application/x-ole-storage",
    ]),
    matches: compoundDocumentMagic,
  },
  txt: {
    mimeTypes: new Set(["text/plain"]),
    matches: textContent,
  },
  csv: {
    mimeTypes: new Set(["text/csv", "text/plain", "application/csv"]),
    matches: textContent,
  },
};

function cleanFileName(fileName: string, extension: string): string {
  const baseName = path.parse(fileName).name || "file";
  const normalized = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const maxBaseLength = Math.max(1, 255 - extension.length - 1);
  return `${normalized.slice(0, maxBaseLength)}.${extension}`;
}

export default function portalRequestAttachmentValidator(
  req: Request,
  res: Response,
  next: NextFunction,
): Response | void {
  const portalRequest = req as ClientPortalRequest;
  const file = portalRequest.file;
  if (!file || !file.buffer?.length) {
    return res
      .status(400)
      .send(new ServerResponse(false, null, "A file is required"));
  }

  if (file.size > MAX_PORTAL_REQUEST_ATTACHMENT_BYTES) {
    return res
      .status(400)
      .send(
        new ServerResponse(
          false,
          null,
          `Maximum request attachment size is ${Math.floor(
            MAX_PORTAL_REQUEST_ATTACHMENT_BYTES / 1024 / 1024,
          )} MB.`,
        ),
      );
  }

  const extension = path
    .extname(file.originalname || "")
    .slice(1)
    .toLowerCase();
  const rule = RULES[extension];
  const mimeType = String(file.mimetype || "").toLowerCase();
  if (!rule || !rule.mimeTypes.has(mimeType) || !rule.matches(file.buffer)) {
    return res
      .status(400)
      .send(
        new ServerResponse(
          false,
          null,
          "The file type or file content is not allowed.",
        ),
      );
  }

  const name = cleanFileName(file.originalname, extension);
  file.originalname = name;
  portalRequest.portalRequestFileMeta = {
    cleanFileName: name,
    extension,
    mimeType,
  };
  return next();
}
