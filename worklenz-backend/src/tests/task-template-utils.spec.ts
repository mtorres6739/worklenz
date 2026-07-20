import {buildTemplateTree, flattenTemplateTasks} from "../controllers/task-template-utils";

describe("task template accountability metadata", () => {
  it("preserves descriptions, labels, due offsets, hierarchy, and dependencies", () => {
    const rows = flattenTemplateTasks([
      {
        key: "section",
        name: "Section",
        sub_tasks: [{
          key: "check",
          name: "Check",
          description: "Verify the result.",
          due_offset_days: 7,
          labels: [{name: "Launch Blocker", color_code: "#ff4d4f"}],
        }],
      },
      {
        key: "authorize",
        name: "Authorize launch",
        depends_on_keys: ["check"],
      },
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({
      item_key: "check",
      parent_item_key: "section",
      description: "Verify the result.",
      due_offset_days: 7,
      labels: [{name: "Launch Blocker", color_code: "#ff4d4f"}],
    });
    expect(rows[2].depends_on_keys).toEqual(["check"]);

    const tree = buildTemplateTree(rows);
    expect(tree).toHaveLength(2);
    expect(tree[0].key).toBe("section");
    expect(tree[0].sub_tasks[0].item_key).toBe("check");
  });

  it("rejects duplicate and unknown stable keys", () => {
    expect(() => flattenTemplateTasks([
      {key: "same", name: "One"},
      {key: "same", name: "Two"},
    ])).toThrow("Duplicate template task key");

    expect(() => flattenTemplateTasks([
      {key: "final", name: "Final", depends_on_keys: ["missing"]},
    ])).toThrow("Unknown dependency key");
  });

  it("keeps legacy name-based hierarchy readable", () => {
    const tree = buildTemplateTree([
      {
        item_key: "legacy-parent",
        parent_item_key: null,
        parent_task_name: null,
        name: "Parent",
        description: null,
        total_minutes: 0,
        due_offset_days: null,
        labels: [],
        depends_on_keys: [],
        sort_order: 0,
      },
      {
        item_key: "legacy-child",
        parent_item_key: null,
        parent_task_name: "Parent",
        name: "Child",
        description: null,
        total_minutes: 0,
        due_offset_days: null,
        labels: [],
        depends_on_keys: [],
        sort_order: 1,
      },
    ]);

    expect(tree[0].sub_tasks[0].name).toBe("Child");
  });
});
