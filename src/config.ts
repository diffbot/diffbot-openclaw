import { Type, type Static } from "typebox";

/**
 * Plugin configuration, stored under plugins.entries.diffbot.config in openclaw.json.
 * Every field is optional: the token also resolves from the environment or the
 * ~/.diffbot/credentials file shared with the db CLI and diffbot-skills.
 */
export const configSchema = Type.Object(
  {
    apiToken: Type.Optional(
      Type.String({
        description:
          "Diffbot API token. When omitted the plugin reads DIFFBOT_API_TOKEN or DIFFBOT_TOKEN from the environment, then a DIFFBOT_API_TOKEN=... line in ~/.diffbot/credentials. Get a free token at https://app.diffbot.com/get-started",
      }),
    ),
    timeoutSeconds: Type.Optional(
      Type.Number({
        description: "Per-request timeout in seconds. Defaults to 120.",
        minimum: 1,
      }),
    ),
  },
  { additionalProperties: false },
);

export type DiffbotConfig = Static<typeof configSchema>;

export const DEFAULT_TIMEOUT_SECONDS = 120;
