import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { QuestionnaireData, ProductEntry } from "../questionnaire-data";
import { PRODUCT_TYPE_OPTIONS } from "../questionnaire-data";

interface ProductsStepProps {
  data: QuestionnaireData;
  onChange: (updates: Partial<QuestionnaireData>) => void;
  errors: Record<string, string>;
}

function generateId(): string {
  return `prod-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function ProductsStep({ data, onChange, errors }: ProductsStepProps) {
  const addProduct = () => {
    const newProduct: ProductEntry = {
      id: generateId(),
      name: "",
      type: "service",
      price: null,
    };
    onChange({ products: [...data.products, newProduct] });
  };

  const updateProduct = (id: string, updates: Partial<ProductEntry>) => {
    onChange({
      products: data.products.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
    });
  };

  const removeProduct = (id: string) => {
    onChange({ products: data.products.filter((p) => p.id !== id) });
  };

  return (
    <div className="space-y-6">
      {errors.products && (
        <p className="text-xs text-[hsl(var(--error))]">{errors.products}</p>
      )}

      {data.products.length === 0 && (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-8 text-center">
          <p className="text-sm text-[hsl(var(--foreground-muted))]">
            No products added yet. Add your first product or service below.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {data.products.map((product, index) => (
          <div
            key={product.id}
            className="rounded-[var(--radius-lg)] border border-border p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[hsl(var(--foreground-muted))]">
                Product {index + 1}
              </span>
              <button
                type="button"
                onClick={() => removeProduct(product.id)}
                className="text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--error))] transition-colors"
                aria-label={`Remove ${product.name || "product"}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-1">
                <Label htmlFor={`name-${product.id}`}>Name</Label>
                <Input
                  id={`name-${product.id}`}
                  placeholder="Product name"
                  value={product.name}
                  onChange={(e) =>
                    updateProduct(product.id, { name: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`type-${product.id}`}>Type</Label>
                <Select
                  id={`type-${product.id}`}
                  value={product.type}
                  onChange={(e) =>
                    updateProduct(product.id, {
                      type: e.target.value as ProductEntry["type"],
                    })
                  }
                >
                  {PRODUCT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`price-${product.id}`}>Price</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[hsl(var(--foreground-muted))]">
                    $
                  </span>
                  <Input
                    id={`price-${product.id}`}
                    type="number"
                    placeholder="0"
                    className="pl-7"
                    value={product.price ?? ""}
                    onChange={(e) =>
                      updateProduct(product.id, {
                        price: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" onClick={addProduct} className="w-full">
        <Plus className="mr-1 h-4 w-4" />
        Add Product
      </Button>
    </div>
  );
}
