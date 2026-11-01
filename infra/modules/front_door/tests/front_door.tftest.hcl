# terraform test, no AWS and no login. What phase 1 asks of a forwarding address.
mock_provider "aws" {
  mock_resource "aws_cloudfront_cache_policy" {
    defaults = { id = "files-cache" }
  }
  mock_resource "aws_cloudfront_response_headers_policy" {
    defaults = { id = "files-cors" }
  }
}

variables {
  name = "test"
}

run "empty_creates_nothing" {
  command = plan

  assert {
    condition     = length(aws_cloudfront_distribution.address) == 0 && length(aws_cloudfront_cache_policy.files) == 0 && length(aws_cloudfront_response_headers_policy.files) == 0
    error_message = "With no addresses, this module must create nothing."
  }
}

run "pass_through" {
  command = apply

  variables {
    addresses = {
      api = {
        origin_domain = "default.example.com"
        routes = [
          { path = "/a/*", origin_domain = "other.example.com" },
          { path = "/b/*", origin_domain = "other.example.com" },
        ]
      }
    }
  }

  assert {
    condition     = contains(aws_cloudfront_distribution.address["api"].default_cache_behavior[0].allowed_methods, "POST")
    error_message = "An api address has to take POST."
  }

  # The managed policies' ids come back empty under the mock provider, so a real plan checks them: Managed-CachingDisabled is
  # 4135ea2d-6df8-44a3-9df3-4b5a84be39ad, and Managed-AllViewerExceptHostHeader is b689b0a8-53d0-40ab-baf2-68738e2966ac.
  assert {
    condition     = aws_cloudfront_distribution.address["api"].default_cache_behavior[0].viewer_protocol_policy == "https-only"
    error_message = "Never a redirect on an api address: it would lose a POST's body."
  }

  assert {
    condition     = length(aws_cloudfront_distribution.address["api"].origin) == 2
    error_message = "Two routes to one origin list it once."
  }

  assert {
    condition     = alltrue([for b in aws_cloudfront_distribution.address["api"].ordered_cache_behavior : b.viewer_protocol_policy == "https-only" && contains(b.allowed_methods, "POST")])
    error_message = "A route passes through like the default."
  }

  assert {
    condition     = length(aws_cloudfront_cache_policy.files) == 0
    error_message = "No file policies without a files address."
  }
}

run "files" {
  command = apply

  variables {
    addresses = {
      media = { files = true, origin_domain = "storage.example.com", origin_path = "/a-bucket" }
    }
  }

  assert {
    condition     = aws_cloudfront_distribution.address["media"].default_cache_behavior[0].cache_policy_id == "files-cache"
    error_message = "A files address caches."
  }

  assert {
    condition     = !contains(aws_cloudfront_distribution.address["media"].default_cache_behavior[0].allowed_methods, "POST")
    error_message = "A files address only reads."
  }

  assert {
    condition     = aws_cloudfront_cache_policy.files[0].max_ttl <= 604800
    error_message = "A deleted file can't stay cached past a week."
  }
}

run "a_domain_needs_a_certificate" {
  command = plan

  variables {
    addresses = {
      api = { origin_domain = "default.example.com", domain = "api.example.com" }
    }
  }

  expect_failures = [aws_cloudfront_distribution.address]
}

run "a_url_is_not_a_host" {
  command = plan

  variables {
    addresses = {
      api = { origin_domain = "https://default.example.com" }
    }
  }

  expect_failures = [var.addresses]
}
