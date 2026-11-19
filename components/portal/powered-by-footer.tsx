import { cn } from "@/lib/utils";
import {
  PORTAL_FOOTER,
  POWERED_BY_DOMAIN,
  POWERED_BY_URL,
} from "@/lib/portal-branding";

function PoweredByLink() {
  return (
    <a
      href={POWERED_BY_URL}
      target="_blank"
      rel="noopener"
      className="font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
    >
      {POWERED_BY_DOMAIN}
    </a>
  );
}

/**
 * The portal card footer ("This link expires in 30 days · Powered by
 * pulseprintautomation.com — …") with the domain linked.
 */
export function PortalFooterText() {
  const [before, after] = PORTAL_FOOTER.split(POWERED_BY_DOMAIN);
  return (
    <>
      {before}
      <PoweredByLink />
      {after}
    </>
  );
}

/**
 * Standalone "Powered by pulseprintautomation.com — print shop automation
 * software." under a customer page that has no card footer line.
 */
export function PoweredByFooter({ className }: { className?: string }) {
  return (
    <p className={cn("mt-6 text-center text-xs text-slate-400", className)}>
      Powered by <PoweredByLink /> — Print Shop Automation Software.
    </p>
  );
}
