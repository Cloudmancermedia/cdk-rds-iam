# RDS Aurora PostgreSQL database with IAM authentication

Watch on [YouTube](https://www.youtube.com/watch?v=hZZnKybWUOU)

This is a sample to show how to spin up an RDS DB with IAM auth enabled using the AWS CDK. It uses a lambda inside the same VPC to connect to the DB with the root user, create the IAM user, and then test authenticating using that IAM user and a token.

Any AWS service can use this IAM user to log into the DB to perform functions. Multiple IAM users can be created for each app that needs to access the DB, eliminating the need to manage and rotate multiple DB credentials.
