import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/I18nContext";

export default function WelcomeBar() {
  const { user } = useAuth();
  const { t } = useI18n();

  if (!user) return null;

  const name = (user.name || "").trim() || user.username;
  const shop = (user.store_name || "").trim();
  const greeting = shop
    ? t("welcome.greetingShop", { name, shop })
    : t("welcome.greeting", { name });

  const daysLeft = user.subscription_days_remaining;
  const showSub =
    user.role !== "admin"
    && daysLeft != null
    && user.subscription_status !== "suspended";

  return (
    <div className="mb-4 sm:mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-display text-lg sm:text-xl font-semibold text-themed truncate">
          {greeting}
        </p>
        {shop ? (
          <p className="mt-0.5 text-sm text-themed-muted truncate">{t("welcome.subtitle")}</p>
        ) : (
          <p className="mt-0.5 text-sm text-themed-muted">{t("welcome.setStoreHint")}</p>
        )}
      </div>
      {showSub && (
        <div
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
            daysLeft === 0 || user.subscription_status === "expired"
              ? "bg-rose-500/15 text-rose-400"
              : daysLeft <= 7
                ? "bg-amber-500/15 text-amber-400"
                : "bg-themed-hover text-themed-muted"
          }`}
        >
          {daysLeft === 0 || user.subscription_status === "expired"
            ? t("welcome.subscriptionExpired")
            : t("welcome.subscriptionDays", { count: daysLeft })}
        </div>
      )}
    </div>
  );
}
