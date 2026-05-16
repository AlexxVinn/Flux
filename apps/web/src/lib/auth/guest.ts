const GUEST_ID_KEY = "flux_guest_id";
const GUEST_LABEL_KEY = "flux_guest_label";

export function getOrCreateGuestId(): string {
  if (typeof window === "undefined") return "guest_ssr";
  let id = localStorage.getItem(GUEST_ID_KEY);
  if (!id) {
    id = `guest_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    localStorage.setItem(GUEST_ID_KEY, id);
  }
  return id;
}

export function guestDisplayLabel(): string {
  if (typeof window === "undefined") return "Guest";
  let label = localStorage.getItem(GUEST_LABEL_KEY);
  if (!label) {
    label = `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.setItem(GUEST_LABEL_KEY, label);
  }
  return label;
}
