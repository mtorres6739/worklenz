import rateLimit from "express-rate-limit";

const response = (message: string) => ({
  done: false,
  body: null,
  message,
});

export const portalRequestCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: response("Too many requests were submitted. Please try again later."),
});

export const portalRequestCommentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: response("Too many comments were submitted. Please try again later."),
});
