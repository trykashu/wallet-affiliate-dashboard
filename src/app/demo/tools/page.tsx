import ToolsClient from "@/components/tools/ToolsClient";
import {
  DEMO_AFFILIATE,
  DEMO_RESOURCES,
  DEMO_SHARE_TEMPLATES,
} from "@/lib/demo-data";

export const dynamic = "force-dynamic";

export default function DemoToolsPage() {
  const referralUrl = `https://signup.kashupay.com?referrer=${DEMO_AFFILIATE.attribution_id}`;
  return (
    <ToolsClient
      affiliate={DEMO_AFFILIATE}
      brand={null}
      referralUrl={referralUrl}
      resources={DEMO_RESOURCES}
      templates={DEMO_SHARE_TEMPLATES}
    />
  );
}
