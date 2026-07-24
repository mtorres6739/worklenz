import {IWorkLenzRequest} from "../interfaces/worklenz-request";
import {IWorkLenzResponse} from "../interfaces/worklenz-response";
import {ServerResponse} from "../models/server-response";
import WorklenzControllerBase from "./worklenz-controller-base";
import HandleExceptions from "../decorators/handle-exceptions";
import {ISESBouncedMessage} from "../interfaces/aws-bounced-email-response";
import {ISESComplaintMessage} from "../interfaces/aws-complaint-email-response";
import {ISESWebhookMessage, ISESDeliveryMessage, ISESSendMessage, ISESRejectMessage} from "../interfaces/aws-delivery-response";
import {log_error} from "../shared/utils";
import {
  recordEmailDeliveryEvent,
  suppressBouncedEmails,
  suppressComplainedEmails,
} from "../shared/email-delivery-events";

export default class AwsSesController extends WorklenzControllerBase {
  @HandleExceptions()
  public static async handleBounceResponse(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const message = JSON.parse(req.body.Message) as ISESBouncedMessage;
    await this.processBounce(message);

    return res.status(200).send(new ServerResponse(true, null));
  }

  @HandleExceptions()
  public static async handleComplaintResponse(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const message = JSON.parse(req.body.Message) as ISESComplaintMessage;
    await this.processComplaint(message);

    return res.status(200).send(new ServerResponse(true, null));
  }

  @HandleExceptions()
  public static async handleReplies(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    return res.status(200).send(new ServerResponse(true, null));
  }

  @HandleExceptions()
  public static async handleDeliveryEvents(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    try {
      const message = JSON.parse(req.body.Message) as ISESWebhookMessage;

      await this.processDeliveryEvent(message);

      return res.status(200).send(new ServerResponse(true, null));
    } catch (error) {
      log_error(error);
      return res.status(200).send(new ServerResponse(true, null)); // Always return 200 to AWS
    }
  }

  private static async processDeliveryEvent(message: ISESWebhookMessage): Promise<void> {
    const messageId = message.mail.messageId;
    const timestamp = new Date(message.mail.timestamp);
    const recipients = message.mail.destination;

    switch (message.notificationType) {
      case 'Send':
        await recordEmailDeliveryEvent('ses', messageId, 'send', recipients, timestamp, null);
        break;

      case 'Delivery':
        const deliveryMessage = message as ISESDeliveryMessage;
        const deliveryTimestamp = new Date(deliveryMessage.delivery.timestamp);
        await recordEmailDeliveryEvent('ses', messageId, 'delivery', deliveryMessage.delivery.recipients, deliveryTimestamp, {
          smtpResponse: deliveryMessage.delivery.smtpResponse,
          processingTimeMillis: deliveryMessage.delivery.processingTimeMillis
        });
        break;

      case 'Reject':
        const rejectMessage = message as ISESRejectMessage;
        await recordEmailDeliveryEvent('ses', messageId, 'reject', recipients, timestamp, {
          reason: rejectMessage.reject.reason
        });
        break;

      case 'Bounce':
        await this.processBounce(message as ISESBouncedMessage);
        break;

      case 'Complaint':
        await this.processComplaint(message as ISESComplaintMessage);
        break;
    }
  }

  private static async processBounce(message: ISESBouncedMessage): Promise<void> {
    if (message.notificationType !== "Bounce" || message.bounce.bounceType !== "Permanent") return;
    const emails = Array.from(new Set(message.bounce.bouncedRecipients.map(r => r.emailAddress)));
    await suppressBouncedEmails(emails);
  }

  private static async processComplaint(message: ISESComplaintMessage): Promise<void> {
    if (message.notificationType !== "Complaint") return;
    const emails = Array.from(new Set(message.complaint.complainedRecipients.map(r => r.emailAddress)));
    await suppressComplainedEmails(emails);
  }
}
