import HandleExceptions from "../decorators/handle-exceptions";
import { IWorkLenzRequest } from "../interfaces/worklenz-request";
import { IWorkLenzResponse } from "../interfaces/worklenz-response";
import { ServerResponse } from "../models/server-response";
import { getSelfHostedCapabilities } from "../shared/self-hosted-capabilities";
import WorklenzControllerBase from "./worklenz-controller-base";

export default class SystemController extends WorklenzControllerBase {
  @HandleExceptions()
  public static async getCapabilities(
    _req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    res.setHeader("Cache-Control", "private, max-age=60");
    return res
      .status(200)
      .send(new ServerResponse(true, getSelfHostedCapabilities()));
  }
}
