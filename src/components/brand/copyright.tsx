import { cacheLife } from "next/cache";

export async function Copyright() {
  "use cache";
  cacheLife("hours");
  const year = new Intl.DateTimeFormat("en", {
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(new Date());
  return <span>Copyright {year} PT Inovasi Biokem Nusantara.</span>;
}
