import { NextFunction, Request, Response } from "express";
import multer from "multer";

import { ServerResponse } from "../models/server-response";
import portalRequestAttachmentValidator, {
  MAX_PORTAL_REQUEST_ATTACHMENT_BYTES,
} from "./validators/portal-request-attachment-validator";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: MAX_PORTAL_REQUEST_ATTACHMENT_BYTES,
  },
});

export default function portalRequestAttachmentUpload(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  upload.single("file")(req, res, (error) => {
    if (error) {
      const tooLarge =
        error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
      return res
        .status(400)
        .send(
          new ServerResponse(
            false,
            null,
            tooLarge
              ? `Maximum request attachment size is ${Math.floor(
                  MAX_PORTAL_REQUEST_ATTACHMENT_BYTES / 1024 / 1024,
                )} MB.`
              : "Unable to process the attachment",
          ),
        );
    }
    return portalRequestAttachmentValidator(req, res, next);
  });
}
