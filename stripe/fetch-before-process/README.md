# Stripe Fetch Before Process

This project is an Express.js application written in TypeScript that demonstrates how to fetch the latest event data from Stripe before processing a webhook. This ensures that you are always working with the most up-to-date Stripe resource data.

## Setup

1.  **Install dependencies:**

    ```bash
    npm install
    ```

2.  **Create a `.env` file:**
    Copy the `.env.example` file to a new file named `.env` and fill in the required environment variables.
    ```bash
    cp .env.example .env
    ```

## Environment Variables

The following environment variables are used by the application:

- `STRIPE_API_KEY`: Your Stripe API key.
- `HOOKDECK_API_KEY`: Your Hookdeck API key.
- `HOOKDECK_WEBHOOK_SECRET`: The secret for your Hookdeck webhook. This is used to verify the authenticity of incoming webhooks.
- `PORT`: Optional. The port the server will listen on. Defaults to `3456`.

## Available Scripts

- **`npm run dev`**: Starts the application in development mode using `nodemon`. The server will automatically restart when source files are changed.
- **`npm run build`**: Compiles the TypeScript code to JavaScript.
- **`npm run serve`**: Starts the application from the compiled JavaScript code.
- **`npm run stripe:trigger <event_name>`**: Triggers a Stripe event using the Stripe CLI. Replace `<event_name>` with the event you want to trigger (e.g., `invoice.created`).
- **`npm run hookdeck:listen`**: Runs `hookdeck ci` to set up your environment and then starts `hookdeck listen` to forward webhooks to your local server. Requires a valid Hookdeck API key in the `.env` file.
