window.__JOBFILL_DATA__ = [
  {
    group: "基本信息",
    items: [
      { label: "姓名", value: "你的姓名" },
      { label: "手机号", value: "你的手机号" },
      { label: "邮箱", value: "你的邮箱" },
      { label: "学校", value: "你的学校" },
      { label: "专业", value: "你的专业" }
    ]
  },
  {
    group: "教育经历",
    items: [
      { label: "最高学历", value: "本科" },
      { label: "毕业时间", value: "2027-06" },
      { label: "GPA", value: "3.8/4.0" }
    ]
  },
  {
    group: "实习经历",
    items: [
      { label: "实习公司", value: "某某公司" },
      { label: "实习岗位", value: "产品实习生" },
      { label: "实习描述", value: "负责需求整理、数据分析、原型协作等。" }
    ]
  },
  {
    group: "项目经历",
    items: [
      { label: "项目名称", value: "JobFill" },
      { label: "项目描述", value: "用于网申表单半自动填写的浏览器扩展。" }
    ]
  },
  {
    group: "技能",
    items: [
      { label: "编程语言", value: "JavaScript, TypeScript, Python" },
      { label: "工具", value: "Figma, Git, Chrome Extension" }
    ]
  }
];

window.dispatchEvent(
  new CustomEvent("jobfill:resume-data", {
    detail: window.__JOBFILL_DATA__
  })
);
