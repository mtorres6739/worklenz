declare module "sns-validator" {
  type ValidationCallback = (error: Error | null, message?: unknown) => void;

  class MessageValidator {
    validate(message: unknown, callback: ValidationCallback): void;
  }

  export = MessageValidator;
}
