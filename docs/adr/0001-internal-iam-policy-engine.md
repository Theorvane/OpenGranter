# Internal IAM-style policy engine

OpenGranter evaluates authorization with its own policy engine rather than calling AWS IAM. It adopts useful IAM semantics such as default denial and explicit Deny precedence. The product needs policies for internal LLM resources without requiring callers to use AWS accounts or STS. This preserves provider and deployment flexibility, while making policy correctness, security testing, and operations the product's responsibility.
