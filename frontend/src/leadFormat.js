/** Format leads for courier / notes export (4 lines per order, blank line between). */

export function formatCityPostal(lead) {
  const parts = [];
  if (lead.postal_code) parts.push(String(lead.postal_code).trim());
  if (lead.city) parts.push(String(lead.city).trim());
  return parts.join(" ");
}

export function formatLeadExport(lead) {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  const cityLine = formatCityPostal(lead);
  return [name, lead.street, cityLine, lead.phone].filter((line) => line && String(line).trim()).join("\n");
}

export function formatLeadsExport(leads) {
  if (!leads.length) return "";
  return `${leads.map(formatLeadExport).join("\n\n")}\n`;
}

export function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
