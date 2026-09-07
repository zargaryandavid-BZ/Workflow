import { handleBazaarConnectComplete } from "@/lib/bazaar-connect";
import { withConnectHandler } from "../_shared";

export async function POST(request: Request) {
  return withConnectHandler(request, (client, secret, body) =>
    handleBazaarConnectComplete(client, secret, body)
  );
}
