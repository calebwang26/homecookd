locals {
  lb_services = { for k, s in var.services : k => s if length(s.path_patterns) > 0 || s.default_route }
  # The more specific routes get priorities; the default_route service takes everything else.
  routed          = { for i, k in sort([for k, s in var.services : k if length(s.path_patterns) > 0]) : k => i + 1 }
  default_service = one([for k, s in var.services : k if s.default_route])
}

resource "aws_security_group" "alb" {
  name   = "${local.name}-alb"
  vpc_id = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "alb_web" {
  for_each = {
    for pair in setproduct(["80", "443"], var.alb_allowed_cidrs) : "${pair[0]}-${pair[1]}" => { port = tonumber(pair[0]), cidr = pair[1] }
  }
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = each.value.cidr
  ip_protocol       = "tcp"
  from_port         = each.value.port
  to_port           = each.value.port
}

resource "aws_vpc_security_group_egress_rule" "alb_to_vpc" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "tcp"
  from_port         = 0
  to_port           = 65535
}

resource "aws_lb" "main" {
  name               = local.name
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
  idle_timeout       = 3700 # a cooking call lasts up to an hour
}

resource "aws_lb_target_group" "service" {
  for_each             = local.lb_services
  name                 = "${local.name}-${each.key}"
  port                 = each.value.port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = each.value.drain_seconds
  # A service with a health_port is checked there: the api answers it from its own thread, so a busy task isn't taken for a dead one (api/src/health.ts).
  # On Nov 2 the old check (traffic port, 5 s to answer, 3 misses) replaced a saturated api task that was still answering. The longer timeout and 5 misses
  # are for every service: a task is now replaced after 75 s of no answer, not 45.
  health_check {
    path                = "/health"
    port                = each.value.health_port == null ? "traffic-port" : tostring(each.value.health_port)
    interval            = 15
    timeout             = 10
    healthy_threshold   = 2
    unhealthy_threshold = 5
  }
  # The rule that lets the load balancer reach the health port goes first, or the check would fail in between.
  depends_on = [aws_vpc_security_group_ingress_rule.service_health_from_alb]
}

resource "aws_lb_listener" "main" {
  load_balancer_arn = aws_lb.main.arn
  port              = var.certificate_arn == null ? 80 : 443
  protocol          = var.certificate_arn == null ? "HTTP" : "HTTPS"
  certificate_arn   = var.certificate_arn
  ssl_policy        = var.certificate_arn == null ? null : "ELBSecurityPolicy-TLS13-1-2-2021-06"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service[local.default_service].arn
  }
}

resource "aws_lb_listener" "redirect" {
  count             = var.certificate_arn == null ? 0 : 1
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener_rule" "service" {
  for_each     = local.routed
  listener_arn = aws_lb_listener.main.arn
  priority     = each.value
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service[each.key].arn
  }
  condition {
    path_pattern { values = var.services[each.key].path_patterns }
  }
}
