// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from "vitest";
import { findHostTarget } from "../index";

type ElSpec = {
  tag: string;
  classes?: string[];
  attrs?: Record<string, string>;
  text?: string;
  children?: ElSpec[];
};

function el(spec: ElSpec): Element {
  const node = document.createElement(spec.tag);
  if (spec.classes) for (const c of spec.classes) node.classList.add(c);
  if (spec.attrs) for (const [k, v] of Object.entries(spec.attrs)) node.setAttribute(k, v);
  if (spec.text) node.textContent = spec.text;
  if (spec.children) for (const c of spec.children) node.appendChild(el(c));
  return node;
}

function mount(spec: ElSpec): Element {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  const root = el(spec);
  document.body.appendChild(root);
  return root;
}

function buildHorizonDrawer(opts: { withPostcodeRow: boolean }): Element {
  const footerChildren: ElSpec[] = [
    {
      tag: "form",
      classes: ["cart-discount__form"],
      children: [
        { tag: "input", attrs: { name: "discount" } },
        { tag: "button", attrs: { type: "submit" }, text: "Apply" },
      ],
    },
  ];

  if (opts.withPostcodeRow) {
    footerChildren.push({
      tag: "div",
      attrs: { "data-ordak-cart-scheduler-embed": "", "data-ordak-mounted": "1" },
      children: [
        {
          tag: "div",
          classes: ["ordak-postcode__row"],
          children: [
            { tag: "input" },
            { tag: "button", attrs: { type: "submit" }, text: "Check" },
          ],
        },
      ],
    });
  }

  footerChildren.push(
    {
      tag: "div",
      classes: ["cart__totals", "totals"],
      children: [{ tag: "div", text: "Subtotal $0" }],
    },
    {
      tag: "div",
      classes: ["cart__ctas"],
      children: [
        {
          tag: "button",
          attrs: { name: "checkout", type: "submit" },
          text: "Check out",
        },
      ],
    },
  );

  return mount({
    tag: "cart-drawer-component",
    classes: ["cart-drawer"],
    children: [
      {
        tag: "div",
        classes: ["cart-drawer__inner"],
        children: [
          { tag: "div", classes: ["cart__items"] },
          { tag: "div", classes: ["cart-drawer__footer"], children: footerChildren },
        ],
      },
    ],
  });
}

function buildDawnDrawer(): Element {
  return mount({
    tag: "cart-drawer",
    classes: ["drawer"],
    children: [
      {
        tag: "div",
        classes: ["drawer__inner"],
        children: [
          { tag: "div", classes: ["cart-items"] },
          {
            tag: "div",
            classes: ["drawer__footer"],
            children: [
              {
                tag: "button",
                attrs: { name: "checkout", type: "submit" },
                text: "Check out",
              },
            ],
          },
        ],
      },
    ],
  });
}

function buildEmptyDrawer(): Element {
  return mount({
    tag: "div",
    classes: ["cart-drawer"],
    children: [
      {
        tag: "div",
        classes: ["cart-drawer__inner"],
        children: [{ tag: "p", text: "Your cart is empty." }],
      },
    ],
  });
}

function buildDrawerWithOnlyAmbiguousSubmits(): Element {
  // Hypothetical theme: no button[name="checkout"], only generic submit
  // buttons — one in a discount form, one inside the footer CTA wrapper.
  // The fallback must scope to the footer one and skip discount.
  return mount({
    tag: "div",
    classes: ["cart-drawer"],
    children: [
      {
        tag: "div",
        classes: ["cart-drawer__inner"],
        children: [
          {
            tag: "form",
            classes: ["cart-discount__form"],
            children: [{ tag: "button", attrs: { type: "submit" }, text: "Apply" }],
          },
          {
            tag: "div",
            classes: ["cart-drawer__footer"],
            children: [
              {
                tag: "div",
                classes: ["cart__ctas"],
                children: [
                  {
                    tag: "button",
                    attrs: { type: "submit", id: "real-checkout" },
                    text: "Continue to checkout",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}

describe("findHostTarget", () => {
  beforeEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  });

  it("Horizon drawer with discount form + postcode row already mounted: returns parent above .cart__ctas", () => {
    const drawer = buildHorizonDrawer({ withPostcodeRow: true });
    const { parent, before } = findHostTarget(drawer);

    expect(before?.classList.contains("cart__ctas")).toBe(true);
    expect(parent.classList.contains("cart-drawer__footer")).toBe(true);
    // Negative guards: never the discount form, postcode row, or our embed.
    expect(parent.closest(".cart-discount__form")).toBeNull();
    expect(parent.closest(".ordak-postcode__row")).toBeNull();
    expect(parent.closest("[data-ordak-cart-scheduler-embed]")).toBeNull();
  });

  it("Horizon drawer with discount form, no postcode row: still places above .cart__ctas", () => {
    const drawer = buildHorizonDrawer({ withPostcodeRow: false });
    const { parent, before } = findHostTarget(drawer);

    expect(before?.classList.contains("cart__ctas")).toBe(true);
    expect(parent.classList.contains("cart-drawer__footer")).toBe(true);
    expect(parent.closest(".cart-discount__form")).toBeNull();
  });

  it("Dawn-style drawer (only button[name=checkout]): unchanged behavior", () => {
    const drawer = buildDawnDrawer();
    const { parent, before } = findHostTarget(drawer);

    // The checkout button's footer wrapper IS the .drawer__footer; parent
    // returned should be its parent (.drawer__inner) and `before` should
    // be the footer itself.
    expect(before?.classList.contains("drawer__footer")).toBe(true);
    expect(parent.classList.contains("drawer__inner")).toBe(true);
  });

  it("drawer with no checkout button at all: falls through to inner container", () => {
    const drawer = buildEmptyDrawer();
    const { parent, before } = findHostTarget(drawer);

    expect(before).toBeNull();
    expect(parent.classList.contains("cart-drawer__inner")).toBe(true);
  });

  it("ambiguous submits (no [name=checkout]): scoped fallback skips discount form, picks footer submit", () => {
    const drawer = buildDrawerWithOnlyAmbiguousSubmits();
    const { parent, before } = findHostTarget(drawer);

    expect(parent.closest(".cart-discount__form")).toBeNull();
    expect(before?.classList.contains("cart__ctas")).toBe(true);
    expect(parent.classList.contains("cart-drawer__footer")).toBe(true);
  });
});
