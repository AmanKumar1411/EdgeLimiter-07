import { betterAuth } from "better-auth";

export const auth = betterAuth({
  emailAndPassword: {
    enabled: false,
  },

  socialProviders: {},

  session: {
    expiresIn: 60 * 60 * 24 * 7,
  },
});