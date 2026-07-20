import rateLimit from "express-rate-limit";

const response = (message: string) => ({
  done: false,
  body: null,
  message,
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: response("Too many login attempts. Please try again in 15 minutes."),
});

export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: response("Too many signup attempts. Please try again later."),
});

export const invitationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: response("Too many invitation requests. Please try again in 15 minutes."),
});
