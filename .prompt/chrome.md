packages/mcp-bundle/src/mcp-server/index.ts,这个文件包含2个部分
1. mcp server的相关内容
2. AdapterClient的相关内容
在保证现有逻辑不变的情况下，把这两个部分拆开，不要写在index.ts一个文件里面，但都放到packages/mcp-bundle/src/mcp-server/目录下。