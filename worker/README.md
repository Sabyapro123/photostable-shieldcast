# Claude proxy for the ShieldCast agents

The site runs its agents on rules by default. To let Claude plan the tool calls without putting an API key in a browser, deploy this Worker.

1. Install Wrangler and sign in: `npx wrangler login`.
2. Deploy from this folder: `npx wrangler deploy`.
3. Store the key as a secret: `npx wrangler secret put ANTHROPIC_API_KEY`.
4. Open the site, go to **Agents**, choose **Claude**, open **Claude settings** and paste the Worker URL as the proxy.

The Worker accepts calls only from the site's own origin, allows two models, caps the reply length and refuses any tool that is not one of the ShieldCast tools. The tools themselves still run in the browser. What reaches Claude is the question and the tool results, which hold a first name, a city and times, and never a phone number, a surname or a diagnosis code.
