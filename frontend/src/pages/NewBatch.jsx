import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useToast } from "../context/ToastContext";
import { useI18n } from "../context/I18nContext";
import { useSearchIndex } from "../context/SearchIndexContext";
import LeadPasteForm from "../components/LeadPasteForm";
import CampaignPanel from "../components/CampaignPanel";
import SelectMenu from "../components/SelectMenu";
import { Package } from "lucide-react";

export default function NewBatch() {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [productId, setProductId] = useState(null);
  const [products, setProducts] = useState([]);
  const [adSpendUsd, setAdSpendUsd] = useState("");
  const [boostDays, setBoostDays] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { show } = useToast();
  const { refresh: refreshSearch } = useSearchIndex();

  useEffect(() => {
    api("/products")
      .then((res) => {
        const list = res.products || [];
        setProducts(list);
        const def = list.find((p) => p.is_default) || list[0];
        if (def) setProductId(def.id);
      })
      .catch((e) => show(e.message, "error"));
  }, [show]);

  const productOptions = useMemo(
    () => products.map((p) => ({
      value: p.id,
      label: `${p.product_code} — ${p.name}`,
      hint: p.offer_label,
    })),
    [products],
  );

  const submit = async ({ leadsText, skipDuplicates }) => {
    if (!name.trim()) return show(t("newBatch.enterName"), "error");
    if (!productId) return show(t("newBatch.selectProduct"), "error");
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        leads_text: leadsText,
        skip_duplicates: !!skipDuplicates,
        product_id: productId,
      };
      if (adSpendUsd) body.ad_spend_usd = parseFloat(adSpendUsd);
      if (boostDays) body.boost_days = parseInt(boostDays, 10);
      const batch = await api("/batches", {
        method: "POST",
        body: JSON.stringify(body),
      });
      show(
        batch.skipped_duplicates > 0
          ? t("batch.ordersAddedSkipped", { count: batch.lead_count, skipped: batch.skipped_duplicates })
          : t("newBatch.created", { name: batch.name, count: batch.lead_count }),
      );
      await refreshSearch();
      navigate(`/batch/${batch.id}`);
    } catch (err) {
      show(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl animate-slide-up">
      <h1 className="font-display text-xl sm:text-2xl font-bold text-themed">{t("newBatch.title")}</h1>
      <p className="mt-1 mb-4 sm:mb-6 text-sm text-themed-muted">{t("newBatch.subtitle")}</p>

      <div className="glass space-y-5 p-4 sm:p-6">
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-themed-subtle">
            {t("newBatch.batchName")} <span className="text-indigo-500">*</span>
          </label>
          <input
            className="input-field text-base font-medium min-h-[48px]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("newBatch.namePlaceholder")}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-themed-subtle">
            {t("newBatch.product")} <span className="text-indigo-500">*</span>
          </label>
          {products.length === 0 ? (
            <p className="text-sm text-themed-muted">
              {t("newBatch.noProducts")}{" "}
              <Link to="/settings" className="text-indigo-400 hover:underline">{t("nav.settings")}</Link>
            </p>
          ) : (
            <SelectMenu
              value={productId}
              options={productOptions}
              onChange={setProductId}
              icon={Package}
              fullWidth
            />
          )}
        </div>

        <CampaignPanel
          adSpendUsd={adSpendUsd}
          setAdSpendUsd={setAdSpendUsd}
          boostDays={boostDays}
          setBoostDays={setBoostDays}
          showSave={false}
        />

        <LeadPasteForm onSubmit={submit} busy={busy} submitLabel={t("newBatch.create")} />
      </div>
    </div>
  );
}
