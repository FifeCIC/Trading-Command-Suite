---
name: update-architecture-framework
description: "Update the Architecture Framework page (/builder/architecture-framework) when adding routes, subsystems, or changing system boundaries. Use when: adding a new API endpoint, creating a new subsystem/module, changing data-flow contracts, or after any architecture-sensitive implementation work."
---
# Update Architecture Framework

> ⚠️ **This skill is for the LIBRARIAN agent only.** Feature-development agents should NOT use this skill. Instead, create a closed GitHub Issue with the `revision-log` label summarizing the change. The Librarian curates `architecture-framework.data.js` periodically from those issues.

## When to Use (Librarian only)

Trigger this skill after:
- A new REST endpoint was added
- A new backend module or subsystem was created
- A new React page/view was added to the shell
- A data-flow contract changed (queue actions, storage schema, bridge payloads)
- A new scoring directive was implemented
- A provider adapter was added or modified
- The system spine or ownership boundaries shifted

## Files to Update

### 1. `src/pages/architecture-framework.data.js` — Static content

| Section | What to update |
|---|---|
| `CURRENT_SLICE` | Add a one-line bullet summarizing the new capability |
| `CURRENT_ROUTE_CONTRACTS` | Add each new endpoint with route, method, permission, owner, contract description, status |
| `ARCHITECTURE_INDEX` | Add a new entry if the feature introduces a new architecture domain |
| `DOMAINS` | Add new domains if the feature extends beyond existing categories |
| `SYSTEM_SPINE` | Add new pipeline steps if the feature changes the data flow |
| `DATABASE_SCHEMA` | Add new Prisma models to coreEntities/marketDataEntities/plannedMetaTables |
| `ROADMAP_ITEMS` | Update the relevant domain card with the completed task |
| `KNOWN_GAPS` | Add new gaps that were discovered during implementation |
| `REVISION_LOG` | Add a dated entry summarizing the change |
| `SECTION_META` | Add search terms for new sections so they're findable via the search box |

### 2. `src/pages/ArchitectureFrameworkPage.jsx` — Component

| What to add | Pattern |
|---|---|
| New data import | Add the new constant to the `import { ... }` block |
| New SectionBlock | Add a `{visibleIds.has('id') && (<SectionBlock id="id" ...><CardGrid /></SectionBlock>)}` block after existing sections |
| New live query | Add a `useQuery` call if a new live-status API endpoint was added |

### 3. `src/pages/architecture-framework.css` — Styles

- Add CSS variables to the `.architecture-framework-theme` block if new semantic colors are needed
- Add new class selectors for any new component patterns

## Pattern Reference

### New SectionBlock pattern
```jsx
{visibleIds.has('your-section-id') && (
  <SectionBlock
    id="your-section-id"
    title="Your Section Title"
    summary="One-line description of what this section covers."
    collapsed={collapsedSections.includes('your-section-id')}
    onToggle={toggleSection}
  >
    <CardGrid cards={YOUR_DATA_CONSTANT} />
  </SectionBlock>
)}
```

### New data constant pattern (for CardGrid)
```js
export const YOUR_DATA_CONSTANT = [
  {
    title: 'Card Title',
    summary: 'Brief explanation of this card.',
    items: [
      'Bullet point one.',
      'Bullet point two.',
      'Bullet point three.',
    ],
  },
]
```

### New route contract entry pattern
```js
{
  route: 'METHOD /path/to/endpoint',
  method: 'GET',
  permission: 'Authenticated operator access',
  owner: 'Controller name',
  contract: 'Short description of what this endpoint does.',
  status: 'active',
},
```

## Verification

1. Run `npm --prefix c:/wamp64/www/trading-command-suite run build` — must pass
2. Load `http://localhost:5188/builder/architecture-framework` and confirm the new section appears in the index
3. Verify search terms match what a developer would type
4. Mark the relevant section(s) as verified using the drift-detection ✓ buttons on the page
5. Update `REVISION_LOG` with the date and a brief summary
