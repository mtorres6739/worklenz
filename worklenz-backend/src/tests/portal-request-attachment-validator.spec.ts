import portalRequestAttachmentValidator, {
  MAX_PORTAL_REQUEST_ATTACHMENT_BYTES,
} from "../middlewares/validators/portal-request-attachment-validator";

function response() {
  const res = {
    status: jest.fn(),
    send: jest.fn(),
  } as any;
  res.status.mockReturnValue(res);
  res.send.mockReturnValue(res);
  return res;
}

function request(originalname: string, mimetype: string, buffer: Buffer) {
  return {
    file: {
      originalname,
      mimetype,
      buffer,
      size: buffer.length,
    },
  } as any;
}

describe("portal request attachment validation", () => {
  it("accepts a PDF whose extension, MIME type, and magic bytes agree", () => {
    const req = request(
      "client brief.pdf",
      "application/pdf",
      Buffer.from("%PDF-1.7\nsafe fixture"),
    );
    const next = jest.fn();

    portalRequestAttachmentValidator(req, response(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.portalRequestFileMeta).toEqual({
      cleanFileName: "client_brief.pdf",
      extension: "pdf",
      mimeType: "application/pdf",
    });
  });

  it("rejects a file whose declared PDF content does not match", () => {
    const res = response();
    const next = jest.fn();

    portalRequestAttachmentValidator(
      request("payload.pdf", "application/pdf", Buffer.from("not a pdf")),
      res,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects executable extensions even with a generic MIME type", () => {
    const res = response();
    const next = jest.fn();

    portalRequestAttachmentValidator(
      request("payload.exe", "application/octet-stream", Buffer.from("MZ")),
      res,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("caps request attachments below the deployment-wide upload limit", () => {
    expect(MAX_PORTAL_REQUEST_ATTACHMENT_BYTES).toBeLessThanOrEqual(
      20 * 1024 * 1024,
    );
  });
});
