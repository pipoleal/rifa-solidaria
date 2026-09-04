// @types/jest-axe só estende os matchers do Jest. Este projeto usa Vitest,
// então precisamos da mesma augmentation para o tipo `Assertion` do Vitest.
import "vitest";

declare module "vitest" {
  interface Assertion {
    toHaveNoViolations: () => void;
  }
}
