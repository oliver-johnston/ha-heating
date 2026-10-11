import { createComponent, type EventName } from "@lit/react";
import { MdFilledButton as MdFilledButtonElement } from "@material/web/button/filled-button.js";
import { MdOutlinedButton as MdOutlinedButtonElement } from "@material/web/button/outlined-button.js";
import { MdTextButton as MdTextButtonElement } from "@material/web/button/text-button.js";
import { MdCheckbox as MdCheckboxElement } from "@material/web/checkbox/checkbox.js";
import { MdDialog as MdDialogElement } from "@material/web/dialog/dialog.js";
import { MdMenu as MdMenuElement } from "@material/web/menu/menu.js";
import { MdMenuItem as MdMenuItemElement } from "@material/web/menu/menu-item.js";
import { MdOutlinedSelect as MdOutlinedSelectElement } from "@material/web/select/outlined-select.js";
import { MdSelectOption as MdSelectOptionElement } from "@material/web/select/select-option.js";
import { MdSwitch as MdSwitchElement } from "@material/web/switch/switch.js";
import { MdPrimaryTab as MdPrimaryTabElement } from "@material/web/tabs/primary-tab.js";
import { MdTabs as MdTabsElement } from "@material/web/tabs/tabs.js";
import { MdOutlinedTextField as MdOutlinedTextFieldElement } from "@material/web/textfield/outlined-text-field.js";
import React from "react";

export const MdFilledButton = createComponent({
  react: React,
  tagName: "md-filled-button",
  elementClass: MdFilledButtonElement,
});

export const MdOutlinedButton = createComponent({
  react: React,
  tagName: "md-outlined-button",
  elementClass: MdOutlinedButtonElement,
});

export const MdTextButton = createComponent({
  react: React,
  tagName: "md-text-button",
  elementClass: MdTextButtonElement,
});

export const MdCheckbox = createComponent({
  react: React,
  tagName: "md-checkbox",
  elementClass: MdCheckboxElement,
  events: {
    onChange: "change" as EventName<Event>,
  },
});

export const MdDialog = createComponent({
  react: React,
  tagName: "md-dialog",
  elementClass: MdDialogElement,
  events: {
    onCancel: "cancel" as EventName<Event>,
    onClosed: "closed" as EventName<Event>,
  },
});

export const MdMenu = createComponent({
  react: React,
  tagName: "md-menu",
  elementClass: MdMenuElement,
  events: {
    onClosed: "closed" as EventName<Event>,
  },
});

export const MdMenuItem = createComponent({
  react: React,
  tagName: "md-menu-item",
  elementClass: MdMenuItemElement,
});

export const MdSwitch = createComponent({
  react: React,
  tagName: "md-switch",
  elementClass: MdSwitchElement,
  events: {
    onChange: "change" as EventName<Event>,
  },
});

export const MdOutlinedTextField = createComponent({
  react: React,
  tagName: "md-outlined-text-field",
  elementClass: MdOutlinedTextFieldElement,
  events: {
    onInput: "input" as EventName<InputEvent>,
  },
});

export const MdOutlinedSelect = createComponent({
  react: React,
  tagName: "md-outlined-select",
  elementClass: MdOutlinedSelectElement,
  events: {
    onChange: "change" as EventName<Event>,
  },
});

export const MdSelectOption = createComponent({
  react: React,
  tagName: "md-select-option",
  elementClass: MdSelectOptionElement,
});

export const MdTabs = createComponent({
  react: React,
  tagName: "md-tabs",
  elementClass: MdTabsElement,
  events: {
    onChange: "change" as EventName<Event>,
  },
});

export const MdPrimaryTab = createComponent({
  react: React,
  tagName: "md-primary-tab",
  elementClass: MdPrimaryTabElement,
});
