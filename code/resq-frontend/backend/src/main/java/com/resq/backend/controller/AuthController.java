package com.resq.backend.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.resq.backend.dto.HubDtos;
import com.resq.backend.service.HubService;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
  private final HubService hubService;

  public AuthController(HubService hubService) {
    this.hubService = hubService;
  }

  @PostMapping("/login")
  public ResponseEntity<HubDtos.LoginResponse> login(@RequestBody HubDtos.LoginRequest request) {
    HubDtos.LoginResponse response = hubService.login(request);
    return ResponseEntity.status(response.success() ? 200 : 401).body(response);
  }
}
