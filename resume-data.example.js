window.__JOBFILL_DATA__ = [
  {
    group: "基本信息",
    items: [
      { label: "姓名", value: "你的姓名" },
      { label: "手机号", value: "你的手机号" },
      { label: "邮箱", value: "你的邮箱" }
    ]
  },
  {
    group: "教育经历",
    items: [
      { label: "学校", value: "你的学校" },
      { label: "专业", value: "你的专业" },
      { label: "毕业时间", value: "2027-06" }
    ]
  }
];

window.dispatchEvent(
  new CustomEvent("jobfill:resume-data", {
    detail: window.__JOBFILL_DATA__
  })
);
