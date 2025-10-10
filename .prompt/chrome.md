1. 先调用mcp工具的dom_query查询页面，获取到当前页面的dom数据
2. 从dom里搜索，比如“限定APPUID尾号用户”这样的规则，找出对应dom元素的选择器
3. 调用mcp工具的dom_click传入选择器，完成点击
4. 再次调用mcp工具的dom_query查询页面，获取到当前页面的dom数据，点击后，会渲染一个新规则在class为rule-editor_rule-card-wrapper的div里
5. 输出这个规则的title，描述，对应表单字段名称（中文）