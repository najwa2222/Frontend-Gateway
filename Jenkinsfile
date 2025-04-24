pipeline {
  agent any

  environment {
    DOCKER_IMAGE               = 'najwa22/gateway-frontend'
    DOCKER_TAG                 = "${env.BUILD_NUMBER}"
    KUBE_NAMESPACE             = 'crda-namespace'
    SONAR_PROJECT_KEY          = 'najwa22_gateway-frontend'
    SONAR_SERVER_URL           = 'http://localhost:9000'
    SONAR_TOKEN_CREDENTIALS_ID = 'sonarqube-token'
    COVERAGE_REPORT            = 'coverage/lcov.info'
    SESSION_SECRET             = credentials('app-session-secret')
    JWT_SECRET                 = credentials('app-jwt-secret')
  }

  options {
    timeout(time: 30, unit: 'MINUTES')
    disableConcurrentBuilds()
  }

  stages {
    stage('Checkout SCM') {
      steps {
        git url: 'https://github.com/najwa2222/Frontend-Gateway.git', branch: 'main'
      }
    }

    stage('Install Dependencies') {
      steps {
        bat 'npm ci --prefer-offline --no-audit --no-fund'
      }
    }

    stage('Lint') {
      steps {
        bat 'npm run lint'
      }
    }

    stage('SonarQube Analysis') {
      steps {
        withSonarQubeEnv('SonarQube') {
          withCredentials([string(credentialsId: SONAR_TOKEN_CREDENTIALS_ID, variable: 'SONAR_TOKEN')]) {
            bat """
              sonar-scanner.bat ^
                -Dsonar.projectKey=${SONAR_PROJECT_KEY} ^
                -Dsonar.sources=. ^
                -Dsonar.host.url=${SONAR_SERVER_URL} ^
                -Dsonar.login=%SONAR_TOKEN% ^
                -Dsonar.javascript.lcov.reportPaths=${COVERAGE_REPORT} ^
                -Dsonar.qualitygate.wait=true
            """
          }
        }
      }
    }

    stage('Build Docker Image') {
      steps {
        script {
          dockerImage = docker.build("${DOCKER_IMAGE}:${DOCKER_TAG}")
        }
      }
    }

    stage('Security Scan (Trivy)') {
      steps {
        script {
          def code = bat(
            script: "trivy image --exit-code 1 --severity CRITICAL --ignore-unfixed ${DOCKER_IMAGE}:${DOCKER_TAG}",
            returnStatus: true
          )
          if (code == 1) {
            error "❌ Trivy found CRITICAL vulnerabilities."
          } else {
            echo "✅ Trivy scan passed."
          }
        }
      }
    }

    stage('Push to Docker Hub') {
      steps {
        withCredentials([usernamePassword(
          credentialsId: 'dockerhub-credentials',
          usernameVariable: 'DOCKER_USER',
          passwordVariable: 'DOCKER_PASS'
        )]) {
          script {
            docker.withRegistry('', 'dockerhub-credentials') {
              dockerImage.push()
              dockerImage.push('latest')
            }
          }
        }
      }
    }

    stage('Deploy to Kubernetes') {
      steps {
        bat """
          kubectl create namespace ${KUBE_NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -
          kubectl apply -n ${KUBE_NAMESPACE} -f k8s/namespace.yaml
          kubectl apply -n ${KUBE_NAMESPACE} -f k8s/app-secret.yaml
          kubectl apply -n ${KUBE_NAMESPACE} -f k8s/frontend-deployment.yaml
          kubectl apply -n ${KUBE_NAMESPACE} -f k8s/frontend-service.yaml
          kubectl rollout status deployment/gateway-frontend -n ${KUBE_NAMESPACE} --timeout=300s
        """
      }
    }
  }

  post {
    success {
      slackSend(
        color: 'good',
        message: "✅ Frontend build & deploy succeeded: ${env.BUILD_URL}",
        channel: '#jenkins-builds',
        tokenCredentialId: 'slack-token'
      )
    }
    failure {
      slackSend(
        color: 'danger',
        message: "❌ Frontend build or deploy failed: ${env.BUILD_URL}",
        channel: '#jenkins-builds',
        tokenCredentialId: 'slack-token'
      )
    }
  }
}
