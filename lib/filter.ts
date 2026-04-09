import type { Filters, Property } from "@/types/property";

export function applyFilters(properties: Property[], filters: Filters): Property[] {
  return properties.filter((property) => {
    if (filters.district && property.district !== filters.district) {
      return false;
    }

    if (filters.price) {
      if (filters.price === "low" && property.price >= 4000) return false;
      if (filters.price === "mid" && (property.price < 4000 || property.price > 6000))
        return false;
      if (filters.price === "high" && property.price <= 6000) return false;
    }

    if (filters.size) {
      if (filters.size === "small" && property.size_sqft >= 100) return false;
      if (filters.size === "med" && (property.size_sqft < 100 || property.size_sqft > 200))
        return false;
      if (filters.size === "large" && property.size_sqft <= 200) return false;
    }

    return true;
  });
}
