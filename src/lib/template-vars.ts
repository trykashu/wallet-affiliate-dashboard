export const TEMPLATE_VARS = ["referral_link", "agent_name", "business_name"] as const;
export type TemplateVar = (typeof TEMPLATE_VARS)[number];
export type TemplateVarValues = Partial<Record<TemplateVar, string>>;

export function interpolate(body: string, vars: TemplateVarValues): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k as TemplateVar];
    return v ?? `{{${k}}}`;
  });
}
