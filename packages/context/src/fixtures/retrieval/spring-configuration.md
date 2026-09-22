---
title: Spring Boot configuration
---

# Spring Boot configuration

## Banner mode

Set spring.main.banner-mode in application.properties to disable the startup
banner. The setting accepts off, console, or log. This example disables the
banner while choosing an HTTP port for the application.

```properties
spring.main.banner-mode=off
server.port=8080
```
