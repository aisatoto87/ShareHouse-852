import {
  getCategoryPreset,
  propertyMatchesCategoryPreset,
} from "@/lib/category-presets";
import { propertyMatchesPriceBand, type PriceBand } from "@/lib/property-pricing";
import { propertyOverlapsUniversityZones } from "@/lib/university-zones";
import type { Filters, Property } from "@/types/property";

export function applyFilters(properties: Property[], filters: Filters): Property[] {
  const preset = getCategoryPreset(filters.categoryPreset);

  return properties.filter((property) => {
    if (preset && !propertyMatchesCategoryPreset(property.tags, preset, property)) {
      return false;
    }

    if (
      filters.universityZones.length > 0 &&
      !propertyOverlapsUniversityZones(
        property.university_zones,
        filters.universityZones
      )
    ) {
      return false;
    }

    if (filters.district && property.district !== filters.district) {
      return false;
    }

    if (filters.price) {
      if (!propertyMatchesPriceBand(property, filters.price as PriceBand)) {
        return false;
      }
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
