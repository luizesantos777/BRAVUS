/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { CHECKOUT_ORIGIN_HEADER } from "../lib/checkout-brand";
import { reconcileCheckoutPayments } from "../lib/checkout-payment-reconciliation";
import { drainCheckoutSales } from "../lib/checkout-portal-sales";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

let nextCheckoutMaintenance = 0;

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    // Derive the brand from the bound public URL, not a proxy's internal Host.
    // Always replace incoming values so a client cannot choose the server context.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(CHECKOUT_ORIGIN_HEADER, url.origin);
    const response = await handler.fetch(new Request(request, { headers: requestHeaders }), env, ctx);
    const paymentRequest = request.method === "POST"
      ? /^\/api\/(?:orders|card\/[^/]+|webhooks\/(?:atlas|beehive))\/?$/.test(url.pathname)
      : request.method === "GET" && /^\/api\/(?:pay|card)\/[^/]+\/?$/.test(url.pathname);
    if (paymentRequest && response.ok) ctx.waitUntil(drainCheckoutSales().catch(() => {}));

    const checkoutPage = request.method === "GET" && /^\/(?:checkout|[ap]\/[^/]+)\/?$/.test(url.pathname);
    if ((paymentRequest || checkoutPage) && Date.now() >= nextCheckoutMaintenance) {
      nextCheckoutMaintenance = Date.now() + 60_000;
      ctx.waitUntil(reconcileCheckoutPayments().catch(() => {}).then(() => drainCheckoutSales()).catch(() => {}));
    }
    return response;
  },
};

export default worker;
