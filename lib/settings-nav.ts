export type SettingsNavItem = {
  href: string;
  label: string;
  description: string;
};

export type SettingsNavGroup = {
  id: string;
  label: string;
  items: SettingsNavItem[];
};

export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    id: "board",
    label: "Board setup",
    items: [
      {
        href: "/settings/columns",
        label: "Columns",
        description: "Pipeline stages, colors, and drop rules",
      },
      {
        href: "/settings/fields",
        label: "Custom Fields",
        description: "Fields on the order form",
      },
      {
        href: "/settings/tags",
        label: "Tags",
        description: "Labels you can put on cards",
      },
      {
        href: "/settings/card-warnings",
        label: "Card Warnings",
        description: "Alerts shown on job cards",
      },
    ],
  },
  {
    id: "automations",
    label: "Automations",
    items: [
      {
        href: "/settings/automations",
        label: "Column automations",
        description: "Moves and notifies when a card changes column",
      },
      {
        href: "/settings/button-automation",
        label: "Button Automation",
        description: "Fast-action buttons and column email/SMS rules",
      },
      {
        href: "/settings/message-templates",
        label: "SMS / Email templates",
        description: "Wording for customer messages",
      },
    ],
  },
  {
    id: "connections",
    label: "Connections",
    items: [
      {
        href: "/settings/integrations",
        label: "Integrations",
        description: "CRM and other connected systems",
      },
      {
        href: "/settings/gdrive",
        label: "GDrive",
        description: "Google Drive folders for artwork",
      },
      {
        href: "/settings/shipping",
        label: "Shipping",
        description: "Carriers and shipping portal",
      },
      {
        href: "/settings/workspace-links",
        label: "Workspace links",
        description: "Shortcuts shown to the team",
      },
    ],
  },
  {
    id: "die",
    label: "Die manufacturers",
    items: [
      {
        href: "/settings/die-manufacturers",
        label: "Die manufacturers",
        description: "Shops that receive die quote requests",
      },
    ],
  },
  {
    id: "records",
    label: "Records",
    items: [
      {
        href: "/settings/archive",
        label: "Archive",
        description: "Finished jobs kept for reference",
      },
      {
        href: "/settings/removed-orders",
        label: "Removed Orders",
        description: "Jobs taken off the board",
      },
    ],
  },
  {
    id: "ops",
    label: "Ops",
    items: [
      {
        href: "/settings/emergency-balance",
        label: "Emergency Balance",
        description: "Board health and load warnings",
      },
      {
        href: "/settings/team",
        label: "Team",
        description: "People and roles on this workspace",
      },
    ],
  },
];
