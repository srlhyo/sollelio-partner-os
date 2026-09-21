/**
 * Reads the magic link out of the local mail catcher.
 *
 * This is what makes the sign-in test real rather than simulated: the suite never
 * mints a token itself, it waits for the message the application actually caused to
 * be sent and follows the link inside it.
 */
import { MAIL_URL } from './env';

interface Message {
  ID: string;
  To: { Address: string }[];
  Created: string;
}

async function latestMessageFor(email: string): Promise<Message | null> {
  const response = await fetch(`${MAIL_URL}/api/v1/messages?limit=50`);
  if (!response.ok) throw new Error(`Mail catcher unreachable: ${response.status}`);

  const body = (await response.json()) as { messages?: Message[] };
  const matching = (body.messages ?? []).filter((message) =>
    message.To.some((to) => to.Address.toLowerCase() === email.toLowerCase()),
  );

  return matching[0] ?? null;
}

export async function deleteAllMail(): Promise<void> {
  await fetch(`${MAIL_URL}/api/v1/messages`, { method: 'DELETE' });
}

/** Waits for a sign-in email and returns the verification link it contains. */
export async function waitForSignInLink(email: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const message = await latestMessageFor(email);
    if (message) {
      const detail = await fetch(`${MAIL_URL}/api/v1/message/${message.ID}`);
      const content = (await detail.json()) as { HTML?: string; Text?: string };
      const body = content.HTML ?? content.Text ?? '';
      const match = /https?:\/\/[^"'\s<>]*\/auth\/v1\/verify[^"'\s<>]*/.exec(body);
      if (match) {
        // Mail bodies carry HTML-escaped ampersands.
        return match[0].replace(/&amp;/g, '&');
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  throw new Error(`No sign-in email arrived for ${email} within ${timeoutMs}ms.`);
}
