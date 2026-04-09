import Navbar from "@/components/Navbar";
import HeroBanner from "@/components/HeroBanner";
import ListingsClient from "@/components/ListingsClient";
import { fetchAllProperties } from "@/lib/property-queries";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "ShareHouse 852 — 香港一站式合租管家服務",
  description: "你揀樓，我哋幫你配對室友。免卻與業主交涉煩惱，輕鬆入住理想空間。",
};

export default async function HomePage() {
  const properties = await fetchAllProperties();

  return (
    <div className="min-h-screen bg-zinc-50">
      <Navbar />
      <HeroBanner />
      <ListingsClient allProperties={properties} />
    </div>
  );
}
