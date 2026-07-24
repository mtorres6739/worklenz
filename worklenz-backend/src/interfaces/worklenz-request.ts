import { Request, Express } from "express";
import { IPassportSession } from "./passport-session";
import { ClientPortalUploadMeta } from "./client-portal-request";

export interface IMemberScope {
  memberIds: string[];
}
export interface IProjectFileMeta {
  extension: string;
  cleanFileName: string;
}

export interface IWorkLenzRequest extends Request {
  user?: IPassportSession;
  memberScope?: IMemberScope;
  file?: Express.Multer.File;
  projectFileMeta?: IProjectFileMeta;
  portalRequestFileMeta?: ClientPortalUploadMeta;
}
